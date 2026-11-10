import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  action?: ReactNode;
  onBack?: () => void;
  includeSafeTop?: boolean;
}

export function ScreenHeader({
  title,
  subtitle,
  badge,
  action,
  onBack,
  includeSafeTop = true,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: palette.bgCanvas,
          borderBottomColor: palette.border,
          paddingTop: includeSafeTop ? Math.max(insets.top + 8, 14) : 12,
        },
      ]}
    >
      <View style={styles.leftRow}>
        {onBack && (
          <Pressable
            onPress={onBack}
            hitSlop={10}
            style={[styles.backBtn, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}
          >
            <Icon name="ArrowLeft" size={18} color={palette.textPrimary} />
          </Pressable>
        )}
        <View style={styles.textWrap}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: palette.textPrimary }]} numberOfLines={1}>
              {title}
            </Text>
            {badge}
          </View>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: palette.textSubtle }]} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {action ? <View style={styles.actionWrap}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    color: '#71717a',
    fontSize: 11,
    marginTop: 2,
  },
  actionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
});
