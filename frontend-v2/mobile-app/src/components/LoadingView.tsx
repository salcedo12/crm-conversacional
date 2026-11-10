import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';

export function LoadingView({ label = 'Cargando...' }: { label?: string }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: palette.bgCanvas }]}>
      <ActivityIndicator color={palette.brand} size="large" />
      <Text style={[styles.text, { color: palette.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
  },
});
