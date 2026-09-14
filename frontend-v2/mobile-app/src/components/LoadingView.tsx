import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export function LoadingView({ label = 'Cargando...' }: { label?: string }) {
  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.emerald} size="large" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  label: { color: colors.muted, fontSize: 13 },
});
