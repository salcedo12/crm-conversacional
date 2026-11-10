import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  subtitle?: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

export function EmptyState({ icon = '📭', title, subtitle, description, action, children }: EmptyStateProps) {
  const { palette } = useTheme();
  const sub = subtitle || description;
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={[styles.title, { color: palette.textSecondary }]}>{title}</Text>
      {sub ? <Text style={[styles.subtitle, { color: palette.textSubtle }]}>{sub}</Text> : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 32,
  },
  icon: {
    fontSize: 36,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
