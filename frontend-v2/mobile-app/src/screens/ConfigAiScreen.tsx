import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../providers/AuthProvider';
import { fetchAiConfig, persistAiConfig, type AiConfigDraft } from '../services/aiConfig';
import { colors } from '../theme/colors';
import type { RootStackParams } from '../types';

type Props = NativeStackScreenProps<RootStackParams, 'ConfigAi'>;

export function ConfigAiScreen({ navigation }: Props) {
  const { companyId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AiConfigDraft | null>(null);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    fetchAiConfig(companyId)
      .then((cfg) => {
        setDraft({
          enabled: cfg.enabled,
          assistantName: cfg.assistantName,
          businessName: cfg.businessName,
          basePrompt: cfg.basePrompt,
          tone: cfg.tone,
          knowledgeBase: cfg.knowledgeBase,
          fallbackMessage: cfg.fallbackMessage,
          maxContextMessages: cfg.maxContextMessages,
          transferKeywords: cfg.transferKeywords || [],
          blockedTopics: cfg.blockedTopics || [],
          followUpSequence: cfg.followUpSequence || [],
        });
      })
      .catch((err) => Alert.alert('Error', 'No se pudo cargar la configuración de IA'))
      .finally(() => setLoading(false));
  }, [companyId]);

  const save = async () => {
    if (!companyId || !draft || saving) return;
    setSaving(true);
    try {
      await persistAiConfig(companyId, draft);
      Alert.alert('Guardado', 'Configuración de IA actualizada.');
    } catch (err) {
      Alert.alert('Error', 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (key: keyof AiConfigDraft, value: any) => {
    setDraft((prev) => prev ? { ...prev, [key]: value } : prev);
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader
        title="Asistente de IA"
        subtitle="Configuración y reglas"
        action={<Pressable onPress={() => navigation.goBack()}><Ionicons name="close" size={24} color={colors.text} /></Pressable>}
      />
      {loading || !draft ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.label}>Activar IA</Text>
                <Text style={styles.hint}>Habilita las respuestas automáticas.</Text>
              </View>
              <Switch
                value={draft.enabled}
                onValueChange={(val) => updateDraft('enabled', val)}
                trackColor={{ false: colors.border, true: colors.brand }}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nombre del asistente</Text>
              <TextInput
                style={styles.input}
                value={draft.assistantName}
                onChangeText={(text) => updateDraft('assistantName', text)}
                placeholderTextColor={colors.muted}
                placeholder="Ej. Sofia"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nombre de la empresa</Text>
              <TextInput
                style={styles.input}
                value={draft.businessName}
                onChangeText={(text) => updateDraft('businessName', text)}
                placeholderTextColor={colors.muted}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Prompt Base</Text>
              <Text style={styles.hint}>Instrucciones de comportamiento principal.</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={draft.basePrompt}
                onChangeText={(text) => updateDraft('basePrompt', text)}
                placeholderTextColor={colors.muted}
                multiline
                textAlignVertical="top"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Base de conocimiento</Text>
              <Text style={styles.hint}>Información sobre productos, precios, etc.</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={draft.knowledgeBase}
                onChangeText={(text) => updateDraft('knowledgeBase', text)}
                placeholderTextColor={colors.muted}
                multiline
                textAlignVertical="top"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Mensaje de Transferencia (Fallback)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={draft.fallbackMessage}
                onChangeText={(text) => updateDraft('fallbackMessage', text)}
                placeholderTextColor={colors.muted}
                multiline
                textAlignVertical="top"
              />
            </View>

            <Pressable style={styles.saveBtn} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.background} /> : <Text style={styles.saveBtnText}>Guardar Configuración</Text>}
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 20 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inputGroup: { gap: 6 },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 12 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, color: colors.text, backgroundColor: colors.background, fontSize: 14 },
  textArea: { minHeight: 100 },
  saveBtn: { height: 48, borderRadius: 8, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  saveBtnText: { color: colors.background, fontSize: 15, fontWeight: '800' },
});
