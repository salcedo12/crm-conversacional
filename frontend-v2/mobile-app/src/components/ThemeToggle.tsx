import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';

interface ThemeToggleProps {
  variant?: 'pill' | 'compact';
  style?: StyleProp<ViewStyle>;
}

/**
 * Réplica exacta de frontend-v2/src/shared/components/ThemeToggle.tsx
 * [ 🌙 Oscuro | ☀️ Claro ]
 */
export function ThemeToggle({ variant = 'pill', style }: ThemeToggleProps) {
  const { theme, setTheme, palette } = useTheme();

  if (variant === 'compact') {
    const isDark = theme === 'dark';
    return (
      <Pressable
        onPress={() => setTheme(isDark ? 'light' : 'dark')}
        accessibilityRole="button"
        accessibilityLabel="Cambiar tema visual"
        style={[
          styles.compactBtn,
          {
            backgroundColor: isDark ? 'rgba(39, 39, 42, 0.85)' : '#ffffff',
            borderColor: isDark ? 'rgba(63, 63, 70, 0.6)' : '#cbd5e1',
          },
          style,
        ]}
      >
        <Icon
          name={isDark ? 'Sun' : 'Moon'}
          size={17}
          color={isDark ? '#fcd34d' : '#B7871C'}
        />
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: palette.isDark ? 'rgba(24, 24, 27, 0.9)' : '#f1f3f5',
          borderColor: palette.border,
        },
        style,
      ]}
    >
      <Pressable
        onPress={() => setTheme('dark')}
        style={[
          styles.segment,
          theme === 'dark' && {
            backgroundColor: '#27272a',
            borderColor: 'rgba(183, 135, 28, 0.48)',
            borderWidth: 1,
          },
        ]}
      >
        <Icon name="Moon" size={13} color={theme === 'dark' ? '#fbbf24' : palette.textMuted} />
        <Text
          style={[
            styles.label,
            {
              color: theme === 'dark' ? '#fcd34d' : palette.textMuted,
              fontWeight: theme === 'dark' ? '700' : '500',
            },
          ]}
        >
          Oscuro
        </Text>
      </Pressable>

      <Pressable
        onPress={() => setTheme('light')}
        style={[
          styles.segment,
          theme === 'light' && {
            backgroundColor: '#ffffff',
            borderColor: '#cbd5e1',
            borderWidth: 1,
          },
        ]}
      >
        <Icon name="Sun" size={13} color={theme === 'light' ? '#B7871C' : palette.textMuted} />
        <Text
          style={[
            styles.label,
            {
              color: theme === 'light' ? '#0D060A' : palette.textMuted,
              fontWeight: theme === 'light' ? '700' : '500',
            },
          ]}
        >
          Claro
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  compactBtn: {
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  label: {
    fontSize: 12,
  },
});
