import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useBranding } from '../providers/BrandingProvider';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';

type Mode = 'login' | 'reset';

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const { branding } = useBranding();
  const { signIn, resetPassword, loading, error } = useAuth();

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLocalError(null);
    if (!email.trim()) {
      setLocalError('Por favor ingresa tu correo electrónico.');
      return;
    }
    if (!password) {
      setLocalError('Por favor ingresa tu contraseña.');
      return;
    }
    if (loading) return;
    try {
      await signIn(email.trim(), password);
    } catch {
      // El contexto AuthProvider ya almacena el mensaje amigable en `error`
    }
  };

  const handleReset = async () => {
    setResetError(null);
    if (!email.trim()) {
      setResetError('Escribe tu correo para enviarte el enlace.');
      return;
    }
    setResetBusy(true);
    try {
      await resetPassword(email.trim());
      setResetSent(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'No se pudo enviar el correo.');
    } finally {
      setResetBusy(false);
    }
  };

  const logoSource = branding.logoUrl
    ? { uri: branding.logoUrl }
    : require('../../assets/icon.png');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: palette.bgCanvas }]}
    >
      {/* Selector compacto de tema Meraki Oscuro / Claro */}
      <View
        style={[
          styles.topBar,
          { top: Math.max(insets.top + 8, 16) },
        ]}
      >
        <ThemeToggle variant="compact" />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 48, 56),
            paddingBottom: Math.max(insets.bottom + 24, 32),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.formContainer}>
          {/* Bloque de Logo y Marca (idéntico a LoginPage.tsx) */}
          <View style={styles.logoBlock}>
            <Image source={logoSource} style={styles.logoImage} resizeMode="cover" />
            <Text style={[styles.appName, { color: palette.textPrimary }]}>
              {branding.appName}
            </Text>
            <Text style={[styles.subtitle, { color: palette.textSubtle }]}>
              {mode === 'login' ? 'Inicia sesión para continuar' : 'Recupera tu contraseña'}
            </Text>
          </View>

          {mode === 'reset' ? (
            resetSent ? (
              <View style={styles.formStack}>
                <View
                  style={[
                    styles.alertBox,
                    {
                      backgroundColor: palette.emeraldBg,
                      borderColor: palette.emeraldBorder,
                    },
                  ]}
                >
                  <Text style={[styles.alertText, { color: palette.emeraldText }]}>
                    Si existe una cuenta con{' '}
                    <Text style={{ fontWeight: '600' }}>{email.trim()}</Text>, te enviamos un
                    correo con el enlace para restablecer tu contraseña. Revisa también la carpeta
                    de spam.
                  </Text>
                </View>

                <Button
                  fullWidth
                  onPress={() => {
                    setMode('login');
                    setResetSent(false);
                  }}
                >
                  Volver a iniciar sesión
                </Button>
              </View>
            ) : (
              <View style={styles.formStack}>
                {resetError && (
                  <View
                    style={[
                      styles.alertBox,
                      {
                        backgroundColor: palette.roseBg,
                        borderColor: palette.roseBorder,
                      },
                    ]}
                  >
                    <Text style={[styles.alertText, { color: palette.roseText }]}>
                      {resetError}
                    </Text>
                  </View>
                )}

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: palette.textMuted }]}>
                    Correo electrónico
                  </Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="tu@email.com"
                    placeholderTextColor={palette.textPlaceholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    onSubmitEditing={handleReset}
                    returnKeyType="send"
                    style={[
                      styles.input,
                      {
                        backgroundColor: palette.bgInput,
                        borderColor: emailFocused ? palette.brandBorder : palette.borderStrong,
                        color: palette.textPrimary,
                      },
                    ]}
                  />
                </View>

                <Button
                  fullWidth
                  loading={resetBusy}
                  disabled={!email.trim() || resetBusy}
                  onPress={handleReset}
                  style={styles.submitSpacing}
                >
                  Enviar enlace de recuperación
                </Button>

                <Pressable
                  onPress={() => {
                    setMode('login');
                    setResetError(null);
                  }}
                  style={styles.backLinkBtn}
                >
                  <Text style={[styles.backLinkText, { color: palette.textSubtle }]}>
                    ← Volver a iniciar sesión
                  </Text>
                </Pressable>
              </View>
            )
          ) : (
            <View style={styles.formStack}>
              {(error || localError) && (
                <View
                  style={[
                    styles.alertBox,
                    {
                      backgroundColor: palette.roseBg,
                      borderColor: palette.roseBorder,
                    },
                  ]}
                >
                  <Text style={[styles.alertText, { color: palette.roseText }]}>
                    {error || localError}
                  </Text>
                </View>
              )}

              {/* Correo electrónico */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: palette.textMuted }]}>
                  Correo electrónico
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="tu@email.com"
                  placeholderTextColor={palette.textPlaceholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  returnKeyType="next"
                  style={[
                    styles.input,
                    {
                      backgroundColor: palette.bgInput,
                      borderColor: emailFocused ? palette.brandBorder : palette.borderStrong,
                      color: palette.textPrimary,
                    },
                  ]}
                />
              </View>

              {/* Contraseña */}
              <View style={styles.fieldGroup}>
                <View style={styles.passwordHeaderRow}>
                  <Text style={[styles.label, { color: palette.textMuted }]}>Contraseña</Text>
                  <Pressable
                    onPress={() => {
                      setMode('reset');
                      setResetError(null);
                      setResetSent(false);
                    }}
                    hitSlop={8}
                  >
                    <Text style={[styles.forgotLink, { color: palette.brandText }]}>
                      ¿Olvidaste tu contraseña?
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.passwordInputWrap}>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    placeholderTextColor={palette.textPlaceholder}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password"
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    onSubmitEditing={handleSubmit}
                    returnKeyType="go"
                    style={[
                      styles.input,
                      styles.passwordInput,
                      {
                        backgroundColor: palette.bgInput,
                        borderColor: passwordFocused ? palette.brandBorder : palette.borderStrong,
                        color: palette.textPrimary,
                      },
                    ]}
                  />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    style={styles.eyeBtn}
                  >
                    <Icon
                      name={showPassword ? 'EyeOff' : 'Eye'}
                      size={16}
                      color={palette.textSubtle}
                    />
                  </Pressable>
                </View>
              </View>

              {/* Botón Iniciar sesión */}
              <Pressable
                disabled={loading}
                onPress={handleSubmit}
                style={({ pressed }) => [
                  styles.loginPrimaryBtn,
                  {
                    backgroundColor: '#059669',
                    opacity: loading ? 0.75 : pressed ? 0.88 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Iniciar sesión"
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <View style={styles.loginBtnContent}>
                    <Icon name="LogIn" size={18} color="#ffffff" />
                    <Text style={styles.loginBtnText}>Iniciar sesión</Text>
                  </View>
                )}
              </Pressable>
            </View>
          )}

          <Text style={[styles.footerText, { color: palette.textSubtle }]}>
            Grupo Constructor Meraki SAS · CRM Conversacional
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topBar: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  formContainer: {
    width: '100%',
    maxWidth: 384,
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 12,
  },
  appName: {
    fontSize: 20,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  formStack: {
    gap: 16,
  },
  alertBox: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  alertText: {
    fontSize: 13,
    lineHeight: 19,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
  },
  passwordHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  forgotLink: {
    fontSize: 11,
    fontWeight: '500',
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  passwordInputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 40,
  },
  eyeBtn: {
    position: 'absolute',
    right: 10,
    padding: 4,
  },
  submitSpacing: {
    marginTop: 4,
  },
  loginPrimaryBtn: {
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  loginBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loginBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  backLinkBtn: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  backLinkText: {
    fontSize: 12,
  },
  footerText: {
    textAlign: 'center',
    fontSize: 11,
    marginTop: 24,
  },
});
