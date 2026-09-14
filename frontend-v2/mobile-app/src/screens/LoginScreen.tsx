import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../providers/AuthProvider';
import { colors } from '../theme/colors';

export function LoginScreen() {
  const { signIn, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [secure, setSecure] = useState(true);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setSending(true);
    try { await signIn(email, password); } catch {} finally { setSending(false); }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <Image source={require('../../assets/icon.png')} style={styles.logo} />
            <View>
              <Text style={styles.brandName}>Meraki CRM</Text>
              <Text style={styles.brandSub}>Conversacional</Text>
            </View>
          </View>

          <View style={styles.form}>
            <View>
              <Text style={styles.title}>Bienvenido</Text>
              <Text style={styles.subtitle}>Atiende tus clientes desde cualquier lugar.</Text>
            </View>
            <View style={styles.field}>
              <Ionicons name="mail-outline" size={18} color={colors.muted} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="Correo"
                placeholderTextColor={colors.faint}
                returnKeyType="next"
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={secure}
                autoComplete="password"
                placeholder="Contrasena"
                placeholderTextColor={colors.faint}
                style={styles.input}
                onSubmitEditing={submit}
              />
              <Pressable onPress={() => setSecure((value) => !value)} hitSlop={10}>
                <Ionicons name={secure ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.muted} />
              </Pressable>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable disabled={sending} onPress={submit} style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}>
              {sending ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Ingresar</Text>}
            </Pressable>
            <View style={styles.secureRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.emerald} />
              <Text style={styles.secureText}>Sesion segura y persistente en este dispositivo</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 28, paddingBottom: 34 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 44, height: 44, borderRadius: 12 },
  brandName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  brandSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  form: { gap: 14, paddingBottom: 48 },
  title: { color: colors.white, fontSize: 31, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 7 },
  field: { height: 54, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 15 },
  input: { flex: 1, color: colors.text, fontSize: 15 },
  error: { color: '#FF8585', fontSize: 12, backgroundColor: '#301315', borderWidth: 1, borderColor: '#63262B', borderRadius: 7, padding: 10 },
  button: { height: 54, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.emerald, marginTop: 2 },
  buttonText: { color: colors.background, fontSize: 15, fontWeight: '800' },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 4 },
  secureText: { color: colors.faint, fontSize: 11 },
});
