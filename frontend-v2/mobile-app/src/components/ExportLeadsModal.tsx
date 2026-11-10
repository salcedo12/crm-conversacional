import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import firestore, { type FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { useTheme } from '../providers/ThemeProvider';
import { exportLeadsReport, shareCsvFile, type LeadSourceItem } from '../services/enterprise';
import { SelectModal } from './SelectModal';
import { Button } from './Button';
import { Icon } from './Icon';

interface ExportLeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
}

const BASE_CHANNELS = [
  { value: 'all', label: 'Todas las fuentes' },
  { value: 'meta_ads', label: 'Meta Ads (Facebook / Instagram Ads)' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'web', label: 'Sitio Web (Formulario / Mapa)' },
  { value: 'whatsapp', label: 'WhatsApp Orgánico (Línea 317)' },
  { value: 'advisor_whatsapp', label: 'WhatsApp Directo Asesor' },
  { value: 'facebook', label: 'Facebook Messenger' },
  { value: 'instagram', label: 'Instagram DM' },
  { value: 'manual', label: 'Manual' },
];

const SOURCE_LABELS: Record<string, string> = {
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
  web: 'Sitio Web',
  whatsapp: 'WhatsApp Orgánico (317)',
  advisor_whatsapp: 'WhatsApp Directo Asesor',
  facebook: 'Facebook Messenger',
  instagram: 'Instagram DM',
  manual: 'Manual',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'new', label: 'Nuevo' },
  { value: 'active', label: 'Activo' },
  { value: 'qualified', label: 'Calificado' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'closed', label: 'Vendido / Cerrado' },
  { value: 'lost', label: 'Perdido' },
];

const STATUS_LABELS: Record<string, string> = {
  new: 'Nuevo',
  active: 'Activo',
  qualified: 'Calificado',
  scheduled: 'Agendado',
  closed: 'Vendido',
  lost: 'Perdido',
};

const MONTH_OPTIONS = [
  { value: 'all', label: 'Todos los meses' },
  { value: '1', label: '01 - Enero' },
  { value: '2', label: '02 - Febrero' },
  { value: '3', label: '03 - Marzo' },
  { value: '4', label: '04 - Abril' },
  { value: '5', label: '05 - Mayo' },
  { value: '6', label: '06 - Junio' },
  { value: '7', label: '07 - Julio' },
  { value: '8', label: '08 - Agosto' },
  { value: '9', label: '09 - Septiembre' },
  { value: '10', label: '10 - Octubre' },
  { value: '11', label: '11 - Noviembre' },
  { value: '12', label: '12 - Diciembre' },
];

const PROJECT_LIST = [
  { value: 'all', label: 'Todos los proyectos' },
  { value: 'Laguna Mar', label: 'Laguna Mar (Melgar, Tolima)' },
  { value: 'Cañón de Arizona', label: 'Cañón de Arizona' },
  { value: 'Río Claro', label: 'Río Claro' },
  { value: 'Llano Grande', label: 'Llano Grande' },
  { value: 'Sobre Montañas', label: 'Sobre Montañas' },
  { value: 'Proyectos de Ibagué', label: 'Proyectos de Ibagué' },
];

function toMillis(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const t = Date.parse(val);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.seconds === 'number') return val.seconds * 1000;
  if (typeof val._seconds === 'number') return val._seconds * 1000;
  return 0;
}

function getBogotaParts(ms: number) {
  if (!ms) return { year: 0, month: 0, formatted: '', monthName: '' };
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthNames = [
    '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  return {
    year,
    month,
    formatted: `${year}-${pad(month)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    monthName: monthNames[month] || '',
  };
}

function extractLeadProject(lead: any): string {
  if (Array.isArray(lead.projectInterest) && lead.projectInterest.length > 0) {
    return String(lead.projectInterest[0] || '').trim();
  }
  if (typeof lead.projectInterest === 'string' && lead.projectInterest.trim()) {
    return lead.projectInterest.trim();
  }
  const meta = lead.metadata || {};
  return String(lead.customFields?.proyecto || lead.firstTouch?.project || meta.project || meta.webProject || meta.webArea || '').trim();
}

function resolveLeadInbox(lead: any): 'central_317' | 'advisor_direct' {
  if (lead.inbox === 'advisor_direct' || lead.source === 'advisor_whatsapp') return 'advisor_direct';
  if (lead.metadata?.advisorWhatsappMirror === 'true' || lead.metadata?.advisorWhatsappMirror === true) return 'advisor_direct';
  return 'central_317';
}

function csvCell(val: unknown): string {
  const s = String(val ?? '').replace(/\r?\n/g, ' ');
  if (s.includes(',') || s.includes('"') || s.includes(';')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function ExportLeadsModal({ isOpen, onClose, companyId }: ExportLeadsModalProps) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();

  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [advisorsMap, setAdvisorsMap] = useState<Record<string, string>>({});
  const [leadSourcesList, setLeadSourcesList] = useState<LeadSourceItem[]>([]);

  const [queriedLeads, setQueriedLeads] = useState<any[]>([]);
  const [hasQueried, setHasQueried] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [querySummary, setQuerySummary] = useState('');
  const [downloading, setDownloading] = useState(false);

  const [source, setSource] = useState('all');
  const [inbox, setInbox] = useState<'all' | 'central_317' | 'advisor_direct'>('all');
  const [advisorId, setAdvisorId] = useState('all');
  const [year, setYear] = useState('all');
  const [month, setMonth] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('all');
  const [project, setProject] = useState('all');
  const [temperature, setTemperature] = useState('all');

  useEffect(() => {
    if (!isOpen || !companyId) return;
    let cancelled = false;
    setLoadingMetadata(true);
    setHasQueried(false);
    setQueriedLeads([]);
    setQuerySummary('');

    Promise.all([
      firestore().collection('companies').doc(companyId).collection('users').get(),
      firestore().collection('companies').doc(companyId).collection('leadSources').get(),
    ])
      .then(([usersSnap, sourcesSnap]) => {
        if (cancelled) return;
        const uMap: Record<string, string> = {};
        usersSnap.docs.forEach((d) => {
          const data = d.data() || {};
          uMap[d.id] = data.displayName || data.name || data.email || d.id;
        });
        const sList: LeadSourceItem[] = sourcesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<LeadSourceItem, 'id'>),
        }));
        setAdvisorsMap(uMap);
        setLeadSourcesList(sList);
      })
      .catch((err) => console.warn('[ExportLeadsModal] metadata load error:', err))
      .finally(() => {
        if (!cancelled) setLoadingMetadata(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, companyId]);

  const sourceSelectOptions = useMemo(() => {
    const base = BASE_CHANNELS.map((c) => ({ ...c, group: 'Canales Digitales' }));
    const active = leadSourcesList
      .filter((s) => s.active)
      .map((s) => ({ value: `source:${s.id}`, label: s.name, group: 'Fuentes Activas' }));
    const inactive = leadSourcesList
      .filter((s) => !s.active)
      .map((s) => ({ value: `source:${s.id}`, label: `${s.name} (Histórica)`, group: 'Fuentes Históricas' }));
    return [...base, ...active, ...inactive];
  }, [leadSourcesList]);

  const advisorOptions = useMemo(() => {
    const list = Object.entries(advisorsMap)
      .map(([uid, name]) => ({ value: uid, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
    return [
      { value: 'all', label: 'Todos los asesores' },
      { value: '__none__', label: 'Sin asignar' },
      ...list,
    ];
  }, [advisorsMap]);

  const applyFilters = (leads: any[]) => {
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00-05:00`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999-05:00`).getTime() : null;

    let targetSourceName = '';
    let targetSourceSlug = '';
    const isCustomSource = source.startsWith('source:');
    if (isCustomSource) {
      targetSourceSlug = source.replace('source:', '');
      const found = leadSourcesList.find((s) => s.id === targetSourceSlug);
      targetSourceName = (found?.name || targetSourceSlug).toLowerCase().trim();
    }

    return leads
      .filter((lead) => {
        const leadInbox = resolveLeadInbox(lead);
        if (inbox !== 'all' && leadInbox !== inbox) return false;

        if (source !== 'all') {
          if (isCustomSource) {
            const lFuente = String(
              lead.fuenteUbicacion || lead.metadata?.fuenteUbicacion || lead.metadata?.smarthomeFuenteOriginal || ''
            )
              .toLowerCase()
              .trim();
            const lSource = String(lead.source || '').toLowerCase().trim();
            if (lFuente !== targetSourceName && !lFuente.includes(targetSourceName) && lSource !== targetSourceSlug) {
              return false;
            }
          } else {
            const ft = lead.firstTouch?.source || lead.source || '';
            const lt = lead.lastTouch?.source || lead.source || '';
            const cur = lead.source || '';
            if (ft !== source && lt !== source && cur !== source) return false;
          }
        }

        if (advisorId !== 'all') {
          if (advisorId === '__none__') {
            if (lead.assignedTo) return false;
          } else if (lead.assignedTo !== advisorId) {
            return false;
          }
        }

        if (status !== 'all' && (lead.status || 'new') !== status) return false;
        if (temperature !== 'all' && lead.aiAnalysis?.temperature !== temperature) return false;

        if (project !== 'all') {
          const lp = extractLeadProject(lead).toLowerCase();
          const tp = project.toLowerCase();
          if (!lp || (!lp.includes(tp) && !tp.includes(lp))) return false;
        }

        const ms = toMillis(lead.createdAt || lead.lastMessageAt);
        if (year !== 'all' || month !== 'all' || fromMs !== null || toMs !== null) {
          if (!ms) return false;
          const parts = getBogotaParts(ms);
          if (year !== 'all' && String(parts.year) !== year) return false;
          if (month !== 'all' && String(parts.month) !== month) return false;
          if (fromMs !== null && ms < fromMs) return false;
          if (toMs !== null && ms > toMs) return false;
        }
        return true;
      })
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  };

  const filteredLeads = useMemo(
    () => (hasQueried ? applyFilters(queriedLeads) : []),
    [hasQueried, queriedLeads, inbox, source, advisorId, status, temperature, project, year, month, dateFrom, dateTo]
  );

  const executeSearch = async (): Promise<any[]> => {
    if (!companyId) return [];
    setQuerying(true);
    try {
      const colRef = firestore().collection('companies').doc(companyId).collection('leads');
      let q: FirebaseFirestoreTypes.Query = colRef;
      let strategyDesc = 'Filtro compuesto';

      if (advisorId !== 'all' && advisorId !== '__none__') {
        q = colRef.where('assignedTo', '==', advisorId);
        strategyDesc = `Asesor: ${advisorsMap[advisorId] || 'Asesor'}`;
      } else if (advisorId === '__none__') {
        q = colRef.where('assignedTo', '==', null);
        strategyDesc = 'Sin asignar';
      } else if (source.startsWith('source:')) {
        const srcId = source.replace('source:', '');
        const srcName = leadSourcesList.find((s) => s.id === srcId)?.name || srcId;
        q = colRef.where('fuenteUbicacion', '==', srcName);
        strategyDesc = `Fuente: ${srcName}`;
      } else if (source !== 'all') {
        q = colRef.where('source', '==', source);
        strategyDesc = `Canal: ${SOURCE_LABELS[source] || source}`;
      } else if (status !== 'all') {
        q = colRef.where('status', '==', status);
        strategyDesc = `Estado: ${STATUS_LABELS[status] || status}`;
      } else if (dateFrom || dateTo) {
        if (dateFrom) {
          q = q.where('createdAt', '>=', firestore.Timestamp.fromDate(new Date(`${dateFrom}T00:00:00-05:00`)));
        }
        if (dateTo) {
          q = q.where('createdAt', '<=', firestore.Timestamp.fromDate(new Date(`${dateTo}T23:59:59.999-05:00`)));
        }
        strategyDesc = 'Rango de fechas';
      } else {
        q = colRef.limit(2000);
        strategyDesc = 'Recientes (hasta 2.000)';
      }

      const snap = await q.get();
      const rawFetched = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const filtered = applyFilters(rawFetched);
      setQueriedLeads(rawFetched);
      setHasQueried(true);
      setQuerySummary(`${filtered.length} coincidencias de ${rawFetched.length} consultados (${strategyDesc})`);
      return filtered;
    } catch (err) {
      Alert.alert('Error', 'No se pudo consultar Firestore con estos filtros.');
      return [];
    } finally {
      setQuerying(false);
    }
  };

  const handleExportCsv = async () => {
    if (downloading) return;
    let leadsToExport = filteredLeads;
    if (!hasQueried) leadsToExport = await executeSearch();
    if (!leadsToExport.length) {
      Alert.alert('Sin resultados', 'No hay leads que coincidan con los filtros seleccionados.');
      return;
    }

    setDownloading(true);
    try {
      const headers = [
        'ID Lead',
        'Fecha Ingreso',
        'Año',
        'Mes',
        'Última Interacción',
        'Nombre Cliente',
        'Teléfono',
        'Correo',
        'Ciudad',
        'Proyecto / Ubicación',
        'Estado Comercial',
        'Asesor Asignado',
        'Canal / Línea',
        '1ra Fuente (First Touch)',
        'Campaña Inicial',
        'Fuente Ubicación',
        'Score IA',
        'Temperatura IA',
        'Último Mensaje',
      ];

      const lines = [headers.map(csvCell).join(',')];
      leadsToExport.forEach((l) => {
        const createdParts = getBogotaParts(toMillis(l.createdAt));
        const lastMsgParts = getBogotaParts(toMillis(l.lastMessageAt || l.lastInboundAt));
        const leadInbox = resolveLeadInbox(l);
        const advisorName = l.assignedTo ? advisorsMap[l.assignedTo] || l.assignedTo : 'Sin asignar';
        const row = [
          l.id || '',
          createdParts.formatted || 'Sin fecha',
          createdParts.year || '',
          createdParts.monthName || '',
          lastMsgParts.formatted || '',
          l.name || 'Sin nombre',
          l.phone || '',
          l.email || '',
          l.city || '',
          extractLeadProject(l),
          STATUS_LABELS[l.status || 'new'] || l.status || 'Nuevo',
          advisorName,
          leadInbox === 'advisor_direct' ? 'WhatsApp Directo Asesor' : 'Línea Central 317',
          SOURCE_LABELS[l.firstTouch?.source || l.source || ''] || l.source || '',
          l.firstTouch?.campaign || l.metadata?.metaCampaignName || '',
          l.fuenteUbicacion || l.metadata?.fuenteUbicacion || '',
          typeof l.aiAnalysis?.score === 'number' ? l.aiAnalysis.score : '',
          l.aiAnalysis?.temperature || '',
          String(l.lastMessageText || '').slice(0, 200),
        ];
        lines.push(row.map(csvCell).join(','));
      });

      const fileName = `Meraki_Leads_${new Date().toISOString().slice(0, 10)}.csv`;
      await shareCsvFile(fileName, lines.join('\r\n'));
    } catch (err) {
      Alert.alert('Error', 'No se pudo generar el archivo de exportación.');
    } finally {
      setDownloading(false);
    }
  };

  const handleCloudFullExport = async () => {
    setDownloading(true);
    try {
      const res = await exportLeadsReport(companyId, inbox);
      if (res.downloadUrl) {
        await Linking.openURL(res.downloadUrl);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo generar el reporte completo en la nube.');
    } finally {
      setDownloading(false);
    }
  };

  const handleReset = () => {
    setSource('all');
    setInbox('all');
    setAdvisorId('all');
    setYear('all');
    setMonth('all');
    setDateFrom('');
    setDateTo('');
    setStatus('all');
    setProject('all');
    setTemperature('all');
    setHasQueried(false);
    setQueriedLeads([]);
    setQuerySummary('');
  };

  if (!isOpen) return null;

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: palette.bgCanvas }]}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: palette.bgCard,
              borderBottomColor: palette.border,
              paddingTop: Math.max(insets.top + 8, 14),
            },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: palette.textPrimary }]}>📥 Exportador Avanzado de Leads</Text>
            <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>
              Filtra por fuente, asesor, canal o fechas y comparte en Excel/CSV.
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}
          >
            <Icon name="X" size={16} color={palette.textSecondary} />
          </Pressable>
        </View>

        {loadingMetadata ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={palette.brand} />
            <Text style={{ fontSize: 12, color: palette.textMuted, marginTop: 8 }}>
              Cargando fuentes y asesores...
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>Fuente / Feria / Canal</Text>
              <SelectModal
                value={source}
                options={sourceSelectOptions}
                onChange={setSource}
                title="Seleccionar Fuente"
                searchable
              />
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Línea / Bandeja</Text>
                <SelectModal
                  value={inbox}
                  options={[
                    { value: 'all', label: 'Todas las líneas' },
                    { value: 'central_317', label: '🏢 Línea 317' },
                    { value: 'advisor_direct', label: '👤 WhatsApp Asesor' },
                  ]}
                  onChange={(v) => setInbox(v as any)}
                  title="Línea de Entrada"
                />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Asesor Asignado</Text>
                <SelectModal
                  value={advisorId}
                  options={advisorOptions}
                  onChange={setAdvisorId}
                  title="Asesor Asignado"
                  searchable
                />
              </View>
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Estado Comercial</Text>
                <SelectModal
                  value={status}
                  options={STATUS_OPTIONS}
                  onChange={setStatus}
                  title="Estado Comercial"
                />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Proyecto Meraki</Text>
                <SelectModal
                  value={project}
                  options={PROJECT_LIST}
                  onChange={setProject}
                  title="Proyecto Meraki"
                />
              </View>
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Año</Text>
                <SelectModal
                  value={year}
                  options={[
                    { value: 'all', label: 'Todos los años' },
                    { value: '2026', label: '2026' },
                    { value: '2025', label: '2025' },
                    { value: '2024', label: '2024' },
                    { value: '2023', label: '2023' },
                  ]}
                  onChange={setYear}
                  title="Año"
                />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Mes</Text>
                <SelectModal
                  value={month}
                  options={MONTH_OPTIONS}
                  onChange={setMonth}
                  title="Mes"
                />
              </View>
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Desde (AAAA-MM-DD)</Text>
                <TextInput
                  value={dateFrom}
                  onChangeText={setDateFrom}
                  placeholder="2026-01-01"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
                />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Hasta (AAAA-MM-DD)</Text>
                <TextInput
                  value={dateTo}
                  onChangeText={setDateTo}
                  placeholder="2026-12-31"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>Temperatura IA</Text>
              <SelectModal
                value={temperature}
                options={[
                  { value: 'all', label: 'Todas las temperaturas' },
                  { value: 'hot', label: '🔥 Caliente (Hot)' },
                  { value: 'warm', label: '🌤️ Tibio (Warm)' },
                  { value: 'cold', label: '❄️ Frío (Cold)' },
                ]}
                onChange={setTemperature}
                title="Temperatura IA"
              />
            </View>

            {querySummary ? (
              <View style={[styles.summaryBox, { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }]}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: palette.emeraldText }}>
                  ✓ {querySummary}
                </Text>
              </View>
            ) : null}

            <View style={styles.row2}>
              <Button variant="secondary" onPress={handleReset} style={{ flex: 1 }}>
                Limpiar Filtros
              </Button>
              <Button
                variant="secondary"
                onPress={executeSearch}
                loading={querying}
                style={{ flex: 1.3 }}
                icon={<Icon name="Search" size={14} color={palette.textPrimary} />}
              >
                Previsualizar Conteo
              </Button>
            </View>

            <Button
              variant="primary"
              onPress={handleExportCsv}
              loading={downloading}
              fullWidth
              icon={<Icon name="Download" size={15} color="#ffffff" />}
            >
              Exportar Filtrados (.CSV / Excel)
            </Button>

            <Pressable
              onPress={handleCloudFullExport}
              disabled={downloading}
              style={[styles.cloudBtn, { borderColor: palette.brandBorder, backgroundColor: palette.brandSoft }]}
            >
              <Icon name="ExternalLink" size={14} color={palette.brandText} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: palette.brandText }}>
                Descargar Base Completa desde Servidor
              </Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 15, fontWeight: '800' },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 14 },
  field: { gap: 5 },
  row2: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontSize: 12, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 12,
  },
  summaryBox: { padding: 12, borderRadius: 12, borderWidth: 1 },
  cloudBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
});
