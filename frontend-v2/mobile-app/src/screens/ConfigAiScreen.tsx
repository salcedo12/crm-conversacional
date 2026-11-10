import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { fetchAiConfig, persistAiConfig, type AiConfigDraft } from '../services/aiConfig';
import type { RootStackParams } from '../types';

type Props = NativeStackScreenProps<RootStackParams, 'ConfigAi'>;

export function ConfigAiScreen({ navigation }: Props) {
  const { companyId, isAdmin } = useAuth();
  const { palette } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AiConfigDraft | null>(null);

  useEffect(() => {
    if (!companyId || !isAdmin) {
      setLoading(false);
      return;
    }
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
      .catch(() => Alert.alert('Error', 'No se pudo cargar la configuración de IA'))
      .finally(() => setLoading(false));
  }, [companyId, isAdmin]);

  const save = async () => {
    if (!companyId || !draft || saving || !isAdmin) return;
    setSaving(true);
    try {
      await persistAiConfig(companyId, draft);
      Alert.alert('Guardado', 'Configuración de IA actualizada.');
    } catch {
      Alert.alert('Error', 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (key: keyof AiConfigDraft, value: any) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  if (!isAdmin) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bgCanvas }]}>
        <ScreenHeader
          title="Asistente de IA"
          subtitle="Configuración y reglas"
          onBack={() =>
            navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')
          }
        />
        <EmptyState
          icon="🔒"
          title="Acceso restringido"
          subtitle="Solo los administradores pueden modificar las reglas del Asistente de IA."
        />
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: palette.bgCanvas }]}>
      <ScreenHeader
        title="Asistente de IA"
        subtitle="Configuración y reglas"
        onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
      />
      {loading || !draft ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.brand} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View
            style={[
              styles.card,
              { backgroundColor: palette.bgSurface, borderColor: palette.border },
            ]}
          >
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: palette.textPrimary }]}>Activar IA</Text>
                <Text style={[styles.hint, { color: palette.textMuted }]}>
                  Habilita las respuestas automáticas.
                </Text>
              </View>
              <Switch
                value={draft.enabled}
                onValueChange={(val) => updateDraft('enabled', val)}
                trackColor={{ false: palette.borderStrong, true: palette.brand }}
                thumbColor="#ffffff"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: palette.textPrimary }]}>
                Nombre del asistente
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderStrong,
                    color: palette.textPrimary,
                  },
                ]}
                value={draft.assistantName}
                onChangeText={(text) => updateDraft('assistantName', text)}
                placeholderTextColor={palette.textPlaceholder}
                placeholder="Ej. Victoria"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: palette.textPrimary }]}>
                Nombre de la empresa
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderStrong,
                    color: palette.textPrimary,
                  },
                ]}
                value={draft.businessName}
                onChangeText={(text) => updateDraft('businessName', text)}
                placeholderTextColor={palette.textPlaceholder}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: palette.textPrimary }]}>Prompt Base</Text>
              <Text style={[styles.hint, { color: palette.textMuted }]}>
                Instrucciones de comportamiento principal.
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textArea,
                  {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderStrong,
                    color: palette.textPrimary,
                  },
                ]}
                value={draft.basePrompt}
                onChangeText={(text) => updateDraft('basePrompt', text)}
                placeholderTextColor={palette.textPlaceholder}
                multiline
                textAlignVertical="top"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: palette.textPrimary }]}>
                Base de conocimiento
              </Text>
              <Text style={[styles.hint, { color: palette.textMuted }]}>
                Información sobre proyectos, precios, financiación, etc.
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textArea,
                  {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderStrong,
                    color: palette.textPrimary,
                  },
                ]}
                value={draft.knowledgeBase}
                onChangeText={(text) => updateDraft('knowledgeBase', text)}
                placeholderTextColor={palette.textPlaceholder}
                multiline
                textAlignVertical="top"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: palette.textPrimary }]}>
                Mensaje de Transferencia (Fallback)
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textArea,
                  {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderStrong,
                    color: palette.textPrimary,
                  },
                ]}
                value={draft.fallbackMessage}
                onChangeText={(text) => updateDraft('fallbackMessage', text)}
                placeholderTextColor={palette.textPlaceholder}
                multiline
                textAlignVertical="top"
              />
            </View>

            <Pressable
              style={[
                styles.saveBtn,
                { backgroundColor: palette.brand },
                saving && { opacity: 0.6 },
              ]}
              onPress={save}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.saveBtnText}>Guardar Configuración</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 18 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  inputGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 11 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 13 },
  textArea: { minHeight: 100 },
  saveBtn: {
    height: 46,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  saveBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
