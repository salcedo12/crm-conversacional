import { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { LeadRow } from '../components/LeadRow';
import { LoadingView } from '../components/LoadingView';
import { useAuth } from '../providers/AuthProvider';
import { useLeads } from '../hooks/useLeads';
import { colors } from '../theme/colors';
import type { MainTabsParams, RootStackParams } from '../types';
import { isUnread } from '../utils/format';
import { createContact, markLeadsRead } from '../services/crm';

export function InboxScreen() {
  const { companyId, profile, user } = useAuth();
  const [search, setSearch] = useState('');
  const [limitSize, setLimitSize] = useState(50);
  const activeLimit = search.trim().length > 0 ? 500 : limitSize;
  const { leads, loading, error } = useLeads(companyId, user?.uid ?? null, profile?.role, activeLimit);
  const [showNewContact, setShowNewContact] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute();
  const filter = (route.params as MainTabsParams['Bandeja'])?.filter;
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (filter === 'pending' && !isUnread(lead.lastInboundAt, lead.readBy?.[user?.uid ?? ''])) return false;
      if (filter === 'hot' && lead.aiAnalysis?.temperature !== 'hot') return false;
      return !term || `${lead.name} ${lead.phone} ${lead.lastMessageText}`.toLowerCase().includes(term);
    });
  }, [filter, leads, search, user?.uid]);

  const handleMarkAllRead = async () => {
    if (!companyId || !user) return;
    const unreadIds = filtered.filter((lead) => isUnread(lead.lastInboundAt, lead.readBy?.[user.uid])).map((lead) => lead.id);
    if (unreadIds.length === 0) return;
    try {
      await markLeadsRead(companyId, unreadIds);
    } catch {
      Alert.alert('Error', 'No se pudieron marcar como leídos.');
    }
  };

  const handleCreateContact = async () => {
    if (!companyId || !newPhone.trim()) return;
    setIsCreating(true);
    try {
      const res = await createContact({ companyId, phone: newPhone.trim(), name: newName.trim() });
      setShowNewContact(false);
      setNewPhone('');
      setNewName('');
      if (res.existed) {
        Alert.alert('Contacto existente', 'Ese número ya estaba registrado.');
      } else {
        Alert.alert('Éxito', 'Contacto creado.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'No se pudo crear el contacto.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-[#0d0d0f]">
      {/* Header matching web's LeadList */}
      <View className="border-b border-zinc-800 px-4 py-3">
        <View className="mb-2 flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-2">
            <Text className="text-sm font-semibold text-zinc-100">Bandeja de Entrada</Text>
            {!loading && (
              <Text className="text-xs font-normal text-zinc-500">
                ({filtered.length}{filtered.length !== leads.length ? `/${leads.length}` : ''})
              </Text>
            )}
            {!loading && filtered.some(l => isUnread(l.lastInboundAt, l.readBy?.[user?.uid ?? ''])) && (
              <View className="rounded-full bg-brand-500/15 px-1.5 py-0.5">
                <Text className="text-[10px] font-medium text-brand-300">
                  {filtered.filter(l => isUnread(l.lastInboundAt, l.readBy?.[user?.uid ?? ''])).length} sin leer
                </Text>
              </View>
            )}
          </View>
          
          <Pressable 
            onPress={() => setShowNewContact(true)}
            className="flex-row items-center gap-1 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2 py-1 active:bg-brand-500/20"
          >
            <Ionicons name="person-add-outline" size={13} color="#ddd6fe" />
            <Text className="text-[11px] font-medium text-brand-200">Nuevo</Text>
          </Pressable>
        </View>

        {!loading && filtered.some(l => isUnread(l.lastInboundAt, l.readBy?.[user?.uid ?? ''])) && (
          <Pressable onPress={handleMarkAllRead} className="mb-2 flex-row items-center gap-1">
            <Ionicons name="checkmark-done-outline" size={13} color="#a1a1aa" />
            <Text className="text-[11px] text-zinc-400">Marcar todo como leído</Text>
          </Pressable>
        )}

        <View className="relative justify-center">
          <TextInput 
            value={search} 
            onChangeText={setSearch} 
            placeholder="Buscar lead..." 
            placeholderTextColor="#71717a" 
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} className="absolute right-3">
              <Ionicons name="close-circle" size={14} color="#71717a" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <LoadingView label="Cargando conversaciones..." />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(lead) => lead.id}
          renderItem={({ item }) => <LeadRow lead={item} userId={user!.uid} onPress={() => navigation.navigate('Chat', { lead: item })} />}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center p-9">
              <Ionicons name="chatbubbles-outline" size={38} color="#3f3f46" />
              <Text className="text-zinc-100 font-bold text-base mt-3.5">Sin conversaciones</Text>
              <Text className="text-zinc-500 text-xs text-center mt-1.5">{error || 'Cuando haya actividad aparecerá aquí.'}</Text>
            </View>
          }
          ListFooterComponent={
            !search && leads.length >= limitSize ? (
              <Pressable onPress={() => setLimitSize(s => s + 50)} className="py-5 items-center justify-center border-t border-zinc-800/50 mt-2">
                <Text className="text-brand-400 text-[13px] font-bold">Cargar más leads</Text>
              </Pressable>
            ) : null
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={filtered.length ? undefined : { flex: 1 }}
        />
      )}

      <Modal visible={showNewContact} transparent animationType="fade" onRequestClose={() => setShowNewContact(false)}>
        <View className="flex-1 bg-black/50 justify-center p-5">
          <View className="bg-surface rounded-xl p-5 border border-zinc-800">
            <Text className="text-zinc-100 text-lg font-bold mb-4">Nuevo Contacto</Text>
            <TextInput 
              className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-zinc-100 mb-3" 
              placeholder="Número (+57...)" 
              placeholderTextColor="#71717a" 
              value={newPhone} 
              onChangeText={setNewPhone} 
              keyboardType="phone-pad" 
            />
            <TextInput 
              className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-zinc-100 mb-3" 
              placeholder="Nombre (Opcional)" 
              placeholderTextColor="#71717a" 
              value={newName} 
              onChangeText={setNewName} 
            />
            <View className="flex-row justify-end gap-2.5 mt-2.5">
              <Pressable 
                className="px-4 py-2.5 rounded-lg bg-zinc-800 active:bg-zinc-700" 
                onPress={() => setShowNewContact(false)} 
                disabled={isCreating}
              >
                <Text className="font-bold text-sm text-zinc-200">Cancelar</Text>
              </Pressable>
              <Pressable 
                className="px-4 py-2.5 rounded-lg bg-brand-600 active:bg-brand-500 opacity-100 disabled:opacity-50" 
                onPress={handleCreateContact} 
                disabled={isCreating || !newPhone.trim()}
              >
                <Text className="font-bold text-sm text-white">{isCreating ? 'Guardando...' : 'Guardar'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
