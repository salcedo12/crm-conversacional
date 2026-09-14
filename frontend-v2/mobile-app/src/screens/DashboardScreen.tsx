import { RefreshControl, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../providers/AuthProvider';
import { useLeads } from '../hooks/useLeads';
import { colors } from '../theme/colors';
import { isUnread } from '../utils/format';
import { countsAsBusinessLead } from '../utils/leadClassification';
import type { MainTabsParams } from '../types';

export function DashboardScreen() {
  const { profile, companyId, user } = useAuth();
  const { leads: allLeads, loading } = useLeads(companyId, user?.uid ?? null, profile?.role);
  const canSeeAllLeads = profile?.role === 'admin' || profile?.role === 'manager';
  const navigation = useNavigation<BottomTabNavigationProp<MainTabsParams>>();
  // Los indicadores solo cuentan datos del negocio (línea 317). Los que entran
  // directo al WhatsApp del asesor quedan fuera del tablero, igual que en la web.
  const leads = allLeads.filter(countsAsBusinessLead);
  const unread = leads.filter((lead) => isUnread(lead.lastInboundAt, lead.readBy?.[user?.uid ?? ''])).length;
  const scheduled = leads.filter((lead) => lead.status === 'scheduled').length;
  const hot = leads.filter((lead) => lead.aiAnalysis?.temperature === 'hot').length;
  const warm = leads.filter((lead) => lead.aiAnalysis?.temperature === 'warm').length;
  const cold = leads.filter((lead) => lead.aiAnalysis?.temperature === 'cold').length;
  const scored = leads.filter((lead) => typeof lead.aiAnalysis?.score === 'number');
  const scoreAverage = scored.length
    ? Math.round(scored.reduce((sum, lead) => sum + (lead.aiAnalysis?.score ?? 0), 0) / scored.length)
    : 0;
  const conversion = leads.length
    ? Math.round((leads.filter((lead) => lead.status === 'scheduled' || lead.status === 'closed').length / leads.length) * 1000) / 10
    : 0;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader
        title="Resumen"
        subtitle={`Hola, ${profile?.displayName ?? 'Asesor'} · Indicadores de tu CRM`}
        action={(
          <Pressable style={styles.refreshButton}>
            <Ionicons name="refresh" size={13} color={colors.text} />
            <Text style={styles.refreshText}>Actualizar</Text>
          </Pressable>
        )}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} tintColor={colors.brand} />}
      >
        <View style={styles.metricsGrid}>
          <Metric label="Leads totales" value={leads.length} detail={`${unread} sin leer`} onPress={() => navigation.navigate('Bandeja', { filter: 'pending' })} />
          <Metric label="Conversión" value={`${conversion}%`} detail="agendados + cerrados" onPress={() => navigation.navigate('Leads', { filter: 'scheduled' })} />
          <Metric label="Citas próximas" value={scheduled} detail="en total" onPress={() => navigation.navigate('Calendario', { mode: 'upcoming' })} />
          <Metric label="Nuevos" value={leads.filter((lead) => lead.status === 'new').length} detail={canSeeAllLeads ? 'en total' : 'asignados a ti'} onPress={() => navigation.navigate('Leads', { filter: 'new' })} />
        </View>

        <View style={styles.aiPanel}>
          <View style={styles.aiHeader}>
            <View style={styles.aiTitleRow}>
              <Ionicons name="sparkles-outline" size={17} color={colors.brand} />
              <Text style={styles.aiTitle}>Análisis IA de leads</Text>
            </View>
            <Text style={styles.aiCount}>{scored.length} calificados</Text>
          </View>
          <AnalysisStat label="Score promedio" value={scoreAverage} color={colors.brand} />
          <AnalysisStat label="Calientes" value={hot} color={colors.emerald} />
          <AnalysisStat label="Tibios" value={warm} color={colors.brand} />
          <AnalysisStat label="Fríos" value={cold} color={colors.cyan} />
          <View style={styles.lossBlock}>
            <Text style={styles.lossTitle}>POR QUÉ SE PIERDEN LOS LEADS</Text>
            <Text style={styles.lossText}>Sin motivos de pérdida registrados todavía.</Text>
          </View>
          <Pressable style={styles.recommendButton}>
            <Ionicons name="bulb-outline" size={15} color={colors.brand} />
            <Text style={styles.recommendText}>Generar recomendación IA</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value, detail, onPress }: { label: string; value: number | string; detail: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.metric, pressed && { borderColor: colors.brand }]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </Pressable>
  );
}

function AnalysisStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.analysisStat}>
      <Text style={styles.analysisLabel}>{label}</Text>
      <Text style={[styles.analysisValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 34, gap: 18 },
  refreshButton: { minHeight: 32, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.subtle, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  refreshText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { width: '48%', minHeight: 96, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 15, justifyContent: 'center' },
  metricValue: { color: colors.text, fontSize: 25, fontWeight: '900', marginTop: 7 },
  metricLabel: { color: '#76819A', fontSize: 11 },
  metricDetail: { color: colors.faint, fontSize: 10, marginTop: 5 },
  aiPanel: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface, padding: 18, gap: 12 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  aiTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  aiCount: { color: colors.faint, fontSize: 10 },
  analysisStat: { minHeight: 70, borderRadius: 7, backgroundColor: colors.raised, paddingHorizontal: 13, justifyContent: 'center' },
  analysisLabel: { color: colors.faint, fontSize: 11 },
  analysisValue: { fontSize: 24, fontWeight: '900', marginTop: 6 },
  lossBlock: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 8 },
  lossTitle: { color: colors.muted, fontSize: 10, fontWeight: '900' },
  lossText: { color: colors.faint, fontSize: 11 },
  recommendButton: { alignSelf: 'flex-start', minHeight: 32, borderRadius: 6, borderWidth: 1, borderColor: colors.brandBorder, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  recommendText: { color: colors.brand, fontSize: 11, fontWeight: '800' },
});
