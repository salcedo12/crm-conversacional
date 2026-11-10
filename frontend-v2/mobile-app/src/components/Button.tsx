import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { useTheme } from '../providers/ThemeProvider';
import { useBranding } from '../providers/BrandingProvider';

interface ButtonProps {
  children: ReactNode;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  fullWidth?: boolean;
  icon?: ReactNode;
}

export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  textStyle,
  fullWidth = false,
  icon,
}: ButtonProps) {
  const { palette } = useTheme();
  const { branding } = useBranding();
  const primaryHex = branding.primaryColor || palette.brand;

  const bgByVariant: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary: primaryHex,
    secondary: palette.isDark ? '#3f3f46' : '#f1f3f5',
    ghost: 'transparent',
    danger: palette.roseBg,
  };

  const borderByVariant: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary: primaryHex,
    secondary: palette.borderStrong,
    ghost: 'transparent',
    danger: palette.roseBorder,
  };

  const textByVariant: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary: '#ffffff',
    secondary: palette.textPrimary,
    ghost: palette.textSecondary,
    danger: palette.roseText,
  };

  const padBySize = {
    sm: { paddingHorizontal: 12, paddingVertical: 6, fontSize: 12 },
    md: { paddingHorizontal: 16, paddingVertical: 9, fontSize: 14 },
    lg: { paddingHorizontal: 20, paddingVertical: 11, fontSize: 15 },
  }[size];

  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bgByVariant[variant],
          borderColor: borderByVariant[variant],
          borderWidth: variant === 'ghost' ? 0 : 1,
          paddingHorizontal: padBySize.paddingHorizontal,
          paddingVertical: padBySize.paddingVertical,
          opacity: isDisabled ? 0.5 : pressed ? 0.88 : 1,
        },
        fullWidth && { width: '100%' },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textByVariant[variant]} />
      ) : (
        icon
      )}
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text
          style={[
            styles.text,
            { color: textByVariant[variant], fontSize: padBySize.fontSize },
            textStyle,
          ]}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
  },
  text: {
    fontWeight: '600',
  },
});
