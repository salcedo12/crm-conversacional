import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingView } from '../components/LoadingView';
import { useAuth } from '../providers/AuthProvider';
import { useLeads } from '../hooks/useLeads';
import { colors } from '../theme/colors';
import type { Lead, MainTabsParams, RootStackParams } from '../types';
import { initials, shortTime } from '../utils/format';

const statusLabel: Record<Lead['status'], string> = {
  new: 'Nuevo', active: 'Activo', qualified: 'Calificado', scheduled: 'Agendado', lost: 'Perdido', closed: 'Vendido',
};

export function LeadsScreen() {
  const { companyId, profile, user } = useAuth();
  const [search, setSearch] = useState('');
  const [limitSize, setLimitSize] = useState(50);
  const activeLimit = search.trim().length > 0 ? 500 : limitSize;
  const { leads, loading } = useLeads(companyId, user?.uid ?? null, profile?.role, activeLimit);
  const canSeeAllLeads = profile?.role === 'admin' || profile?.role === 'manager';
  const route = useRoute();
  const initialFilter = (route.params as MainTabsParams['Leads'])?.filter ?? 'all';
  const [filter, setFilter] = useState<'all' | 'new' | 'scheduled' | 'hot'>(initialFilter);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const filtered = useMemo(() => leads.filter((lead) => {
    const matchesStatus = filter === 'all'
      || (filter === 'hot' ? lead.aiAnalysis?.temperature === 'hot' : lead.status === filter);
    const term = search.toLowerCase().trim();
    return matchesStatus && (!term || `${lead.name} ${lead.phone}`.toLowerCase().includes(term));
  }), [leads, search, filter]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader title="Leads" subtitle={canSeeAllLeads ? 'Todos los contactos' : 'Contactos asignados a ti'} />
      <View style={styles.search}><Ionicons name="search" size={18} color={colors.muted} /><TextInput value={search} onChangeText={setSearch} placeholder="Nombre o telefono" placeholderTextColor={colors.faint} style={styles.input} /></View>
      <View style={styles.filters}>
        <FilterButton active={filter === 'all'} label={`Todos ${leads.length}`} onPress={() => setFilter('all')} />
        <FilterButton active={filter === 'new'} label="Nuevos" onPress={() => setFilter('new')} />
        <FilterButton active={filter === 'scheduled'} label="Agendados" onPress={() => setFilter('scheduled')} />
        <FilterButton active={filter === 'hot'} label="Calientes" onPress={() => setFilter('hot')} />
      </View>
      {loading ? <LoadingView /> : (
        <FlatList
          data={filtered}
          keyExtractor={(lead) => lead.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate('Chat', { lead: item })} style={({ pressed }) => [styles.card, pressed && { borderColor: colors.brand }]}>
              <View style={styles.cardTop}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials(item.name)}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={styles.name}>{item.name || 'Sin nombre'}</Text>
                  <Text style={styles.phone}>{item.phone}</Text>
                </View>
                {item.aiAnalysis ? <View style={styles.score}><Text style={styles.scoreValue}>{item.aiAnalysis.score}</Text><Text style={styles.scoreLabel}>IA</Text></View> : null}
              </View>
              <Text numberOfLines={2} style={styles.lastMessage}>{item.lastMessageText || 'Sin mensajes recientes'}</Text>
              <View style={styles.cardBottom}>
                <View style={[styles.status, item.status === 'scheduled' && styles.statusScheduled]}><Text style={[styles.statusText, item.status === 'scheduled' && { color: colors.amber }]}>{statusLabel[item.status]}</Text></View>
                <Text style={styles.time}>{shortTime(item.lastMessageAt)}</Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No hay leads con este filtro.</Text>}
          ListFooterComponent={
            !search && leads.length >= limitSize ? (
              <Pressable onPress={() => setLimitSize(s => s + 50)} style={{ paddingVertical: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10 }}>
                <Text style={{ color: colors.brand, fontSize: 13, fontWeight: '700' }}>Cargar más contactos</Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

function FilterButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.filter, active && styles.filterActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  search: { marginHorizontal: 16, marginTop: 14, height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12 },
  input: { flex: 1, color: colors.text, fontSize: 13 },
  filters: { flexDirection: 'row', gap: 7, paddingHorizontal: 16, paddingVertical: 12 },
  filter: { paddingHorizontal: 12, height: 32, justifyContent: 'center', borderRadius: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.brandDark, borderColor: colors.brandBorder },
  filterText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  filterTextActive: { color: colors.brand },
  list: { padding: 16, paddingTop: 2, gap: 9, paddingBottom: 28 },
  card: { padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  name: { color: colors.text, fontSize: 14, fontWeight: '700' },
  phone: { color: colors.muted, fontSize: 11, marginTop: 3 },
  score: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, borderWidth: 2, borderColor: colors.brand },
  scoreValue: { color: colors.text, fontSize: 12, fontWeight: '800' },
  scoreLabel: { color: colors.muted, fontSize: 7 },
  lastMessage: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  status: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, backgroundColor: '#102840' },
  statusScheduled: { backgroundColor: '#302405' },
  statusText: { color: colors.cyan, fontSize: 9, fontWeight: '700' },
  time: { color: colors.faint, fontSize: 10 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 50 },
});
