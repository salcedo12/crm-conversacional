import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon, type LucideIconName } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  subtitle?: string;
}

interface SelectModalProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  prefixLabel?: string;
  title?: string;
  searchable?: boolean;
  icon?: LucideIconName;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function SelectModal({
  value,
  options,
  onChange,
  placeholder = 'Seleccionar...',
  prefixLabel,
  title = 'Seleccionar opción',
  searchable = false,
  icon,
  compact = false,
  style,
  disabled = false,
}: SelectModalProps) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.group && opt.group.toLowerCase().includes(q)) ||
        (opt.subtitle && opt.subtitle.toLowerCase().includes(q))
    );
  }, [options, query]);

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => {
          setQuery('');
          setOpen(true);
        }}
        style={[
          styles.trigger,
          compact ? styles.triggerCompact : styles.triggerNormal,
          {
            backgroundColor: palette.bgInput,
            borderColor: palette.borderInput,
            opacity: disabled ? 0.55 : 1,
          },
          style,
        ]}
      >
        <View style={styles.triggerLeft}>
          {icon && <Icon name={icon} size={14} color={palette.textMuted} />}
          {prefixLabel ? (
            <Text style={{ fontSize: compact ? 11 : 12, color: palette.textMuted, fontWeight: '500' }}>
              {prefixLabel}
            </Text>
          ) : null}
          <Text
            style={[
              styles.triggerText,
              {
                color: selected ? palette.textPrimary : palette.placeholder,
                fontSize: compact ? 11.5 : 12,
                fontWeight: prefixLabel ? '700' : '600',
              },
            ]}
            numberOfLines={1}
          >
            {selected ? selected.label : placeholder}
          </Text>
        </View>
        <Icon name="ChevronDown" size={13} color={palette.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.backdrop, { backgroundColor: palette.backdrop }]} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
            onPress={() => {}}
          >
            <View style={[styles.header, { borderBottomColor: palette.border }]}>
              <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <Icon name="X" size={18} color={palette.textMuted} />
              </Pressable>
            </View>

            {(searchable || options.length > 10) && (
              <View style={[styles.searchBox, { backgroundColor: palette.bgInput, borderColor: palette.borderInput }]}>
                <Icon name="Search" size={14} color={palette.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar..."
                  placeholderTextColor={palette.placeholder}
                  style={[styles.searchInput, { color: palette.textPrimary }]}
                />
              </View>
            )}

            <FlatList
              data={filtered}
              keyExtractor={(item, idx) => `${item.value}-${idx}`}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => {
                const isSelected = item.value === value;
                const prevGroup = index > 0 ? filtered[index - 1]?.group : undefined;
                const showGroup = !!item.group && item.group !== prevGroup;
                return (
                  <View>
                    {showGroup && (
                      <View style={[styles.groupRow, { backgroundColor: palette.bgElevated }]}>
                        <Text style={[styles.groupLabel, { color: palette.textMuted }]}>{item.group}</Text>
                      </View>
                    )}
                    <Pressable
                      onPress={() => {
                        onChange(item.value);
                        setOpen(false);
                      }}
                      style={[
                        styles.optionRow,
                        { borderBottomColor: palette.border },
                        isSelected && { backgroundColor: palette.brandSoft },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.optionLabel,
                            { color: isSelected ? palette.brandText : palette.textPrimary },
                            isSelected && { fontWeight: '700' },
                          ]}
                        >
                          {item.label}
                        </Text>
                        {item.subtitle ? (
                          <Text style={[styles.optionSub, { color: palette.textSubtle }]}>{item.subtitle}</Text>
                        ) : null}
                      </View>
                      {isSelected && <Icon name="Check" size={15} color={palette.brand} />}
                    </Pressable>
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={{ color: palette.textSubtle, fontSize: 12 }}>Sin opciones</Text>
                </View>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
  },
  triggerNormal: {
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  triggerCompact: {
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  triggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  triggerText: {
    fontWeight: '600',
    flexShrink: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  groupRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  groupLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionLabel: {
    fontSize: 13,
  },
  optionSub: {
    fontSize: 11,
    marginTop: 2,
  },
  empty: {
    padding: 24,
    alignItems: 'center',
  },
});
